import { z } from 'zod';
import { CALENDAR_DATE_REGEX } from '../utils/time';
import {
  FormFindingSeverityEnum,
  RecheckInputSchema,
  VisitFormAnswersSchema,
  VisitFormAssemblyWarningSchema,
  VisitFormLibraryBundleSchema,
  VisitFormSnapshotSchema,
  VisitKindEnum,
} from './form.schema';
import { SubmissionGeotagInputSchema, SubmissionGeotagSchema, CaptureSummarySchema } from './evidence.schema';
import { ApprovalProgressDtoSchema } from './process.schema';
import { ProjectGeofenceSchema } from './geofence.schema';
import { GeofenceStatusEnum } from '../enums';

/**
 * Redesign R4: scheduled visits (spec sections 6.3–6.5, 8). A visit is planned from the project
 * type's visit plan (or by hand), published to its officers with a frozen form (R3 snapshot),
 * answered from the field app and accepted through the project's report approval chain.
 * Names follow the cross-plan register (`redesign_contracts_r3_r7.md`): `visitKind`,
 * `formSnapshotId` + `formHash`.
 */

const Uuid = z.string().uuid();
const CalendarDate = z.string().regex(CALENDAR_DATE_REGEX, 'Use YYYY-MM-DD');
const Comment = z.string().trim().min(3, 'Add a comment (at least 3 characters)').max(1000);

// ---------------------------------------------------------------------------
// Enums (D-R4.2, D-R4.3)
// ---------------------------------------------------------------------------

export const VisitStatusEnum = z.enum(['PROPOSED', 'PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED', 'MISSED', 'CANCELLED']);
export type VisitStatus = z.infer<typeof VisitStatusEnum>;
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  PROPOSED: 'Proposed',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Awaiting approval',
  RETURNED: 'Returned',
  APPROVED: 'Accepted',
  MISSED: 'Missed',
  CANCELLED: 'Cancelled',
};
/** Visits not yet checked in or submitted: their form can be rebuilt, officers can respond. */
export const VISIT_NOT_STARTED_STATUSES: VisitStatus[] = ['PROPOSED', 'PLANNED'];
/** Visits that still owe a submission. */
export const VISIT_OPEN_STATUSES: VisitStatus[] = ['PLANNED', 'IN_PROGRESS', 'RETURNED'];

export const VisitConfirmationEnum = z.enum(['UNCONFIRMED', 'CONFIRMED', 'DECLINED']);
export type VisitConfirmation = z.infer<typeof VisitConfirmationEnum>;
export const VISIT_CONFIRMATION_LABELS: Record<VisitConfirmation, string> = {
  UNCONFIRMED: 'Not confirmed',
  CONFIRMED: 'Confirmed',
  DECLINED: 'Declined',
};

export const VisitOriginEnum = z.enum(['PLAN', 'MANUAL', 'UNSCHEDULED']);
export type VisitOrigin = z.infer<typeof VisitOriginEnum>;

// ---------------------------------------------------------------------------
// Project type key `monitoring` (D-R4.10, D-R4.11)
// ---------------------------------------------------------------------------

export const VisitPlanRuleKindEnum = z.enum([
  'EVERY_N_WEEKS_DURING_CONSTRUCTION',
  'EVERY_N_WEEKS_IN_SPRINTS',
  'EVERY_N_WEEKS_UNTIL_MOBILISED',
  'QUARTERLY',
  'ONCE_AFTER_START',
  'ON_COMPLETION_NOTICE',
  'AFTER_PROJECT_CLOSED',
]);
export type VisitPlanRuleKind = z.infer<typeof VisitPlanRuleKindEnum>;
export const VISIT_PLAN_RULE_KIND_LABELS: Record<VisitPlanRuleKind, string> = {
  EVERY_N_WEEKS_DURING_CONSTRUCTION: 'Every N weeks during construction',
  EVERY_N_WEEKS_IN_SPRINTS: 'Every N weeks in chosen sprints',
  EVERY_N_WEEKS_UNTIL_MOBILISED: 'Every N weeks until the contractor is on site',
  QUARTERLY: 'Quarterly',
  ONCE_AFTER_START: 'Once, after the start',
  ON_COMPLETION_NOTICE: 'On the completion notice',
  AFTER_PROJECT_CLOSED: 'After the project is closed',
};

export const VISIT_PLAN_RULE_KEY_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const VisitPlanRuleSchema = z.object({
  /** Stable key; generated visits store `<key>:<date>` so regeneration never duplicates. */
  key: z.string().trim().regex(VISIT_PLAN_RULE_KEY_REGEX, 'Use 1 to 32 lower-case letters, digits, "-" or "_"'),
  visitKind: VisitKindEnum,
  kind: VisitPlanRuleKindEnum,
  /** EVERY_N_WEEKS_* rules. */
  intervalWeeks: z.number().int().min(1).max(26).default(2),
  /** EVERY_N_WEEKS_IN_SPRINTS: sprint numbers (empty = every sprint). */
  sprintNumbers: z.array(z.number().int().min(1).max(200)).max(50).default([]),
  /** ONCE_AFTER_START, ON_COMPLETION_NOTICE, QUARTERLY: working days after the trigger. */
  offsetWorkdays: z.number().int().min(0).max(120).default(5),
  /** AFTER_PROJECT_CLOSED without a dated evaluation milestone: calendar days after closing. */
  offsetDays: z.number().int().min(0).max(1100).default(90),
  /** QUARTERLY: the first month of the first quarter (1 = January). */
  quarterAnchorMonth: z.number().int().min(1).max(12).default(1),
});
export type VisitPlanRule = z.infer<typeof VisitPlanRuleSchema>;
export type VisitPlanRuleInput = z.input<typeof VisitPlanRuleSchema>;

export const ProjectTypeMonitoringConfigSchema = z
  .object({
    visitPlan: z.array(VisitPlanRuleSchema).max(20).default([]),
    /** Calendar days after the planned date to submit (spec: within a week). */
    submissionDeadlineDays: z.number().int().min(1).max(60).default(7),
    /** Days before an unconfirmed visit when the officer is reminded. */
    unconfirmedReminderDays: z.number().int().min(0).max(14).default(2),
    /** Days a finding may stay open before it is escalated. */
    findingEscalationDays: z.number().int().min(1).max(365).default(14),
    /** Warn when an active project has had no visit for this many weeks. */
    noVisitWarningWeeks: z.number().int().min(1).max(52).default(4),
    /** Days after a sprint ends by which it should be verified. */
    sprintVerificationDays: z.number().int().min(0).max(60).default(7),
    /** Email the contractor organisation the open findings after each accepted visit. */
    emailContractorFindingsSummary: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.visitPlan.forEach((r, i) => {
      if (seen.has(r.key)) ctx.addIssue({ code: 'custom', message: `Rule key "${r.key}" is used twice`, path: ['visitPlan', i, 'key'] });
      seen.add(r.key);
    });
  });
export type ProjectTypeMonitoringConfig = z.infer<typeof ProjectTypeMonitoringConfigSchema>;
export type ProjectTypeMonitoringConfigInput = z.input<typeof ProjectTypeMonitoringConfigSchema>;

/** The default plan seeded on the programme types (D-R4.13). */
export const DEFAULT_VISIT_PLAN: VisitPlanRuleInput[] = [
  { key: 'mobilisation', visitKind: 'MOBILISATION_CHECK', kind: 'EVERY_N_WEEKS_UNTIL_MOBILISED', intervalWeeks: 2 },
  { key: 'baseline', visitKind: 'BASELINE', kind: 'ONCE_AFTER_START', offsetWorkdays: 5 },
  { key: 'routine', visitKind: 'ROUTINE', kind: 'EVERY_N_WEEKS_DURING_CONSTRUCTION', intervalWeeks: 2 },
  { key: 'quarterly', visitKind: 'QUARTERLY_ME', kind: 'QUARTERLY', quarterAnchorMonth: 1, offsetWorkdays: 5 },
  { key: 'final', visitKind: 'FINAL_EVALUATION', kind: 'ON_COMPLETION_NOTICE', offsetWorkdays: 5 },
];
export const DEFAULT_POST_CLOSURE_RULE: VisitPlanRuleInput = {
  key: 'post-closure',
  visitKind: 'POST_CLOSURE_EVALUATION',
  kind: 'AFTER_PROJECT_CLOSED',
  offsetDays: 180,
};

// ---------------------------------------------------------------------------
// Tenant setting (D-R4.15)
// ---------------------------------------------------------------------------

export const DEFAULT_VISIT_RESCHEDULE_TOLERANCE_WORKDAYS = 2;
export const VisitRescheduleToleranceSchema = z.number().int().min(0).max(10);

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export const VisitWarningCodeEnum = z.enum([
  'OFFICER_OVER_LIMIT',
  'OFFICER_TWO_REGIONS_SAME_DAY',
  'SPRINT_WITHOUT_VISIT',
  'NO_RECENT_VISIT',
  'VISIT_OUTSIDE_SPRINT',
  'VISIT_WITHOUT_OFFICER',
]);
export type VisitWarningCode = z.infer<typeof VisitWarningCodeEnum>;

export const VisitWarningSchema = z.object({
  code: VisitWarningCodeEnum,
  message: z.string(),
  projectId: Uuid.nullable(),
  visitId: Uuid.nullable(),
  userId: Uuid.nullable(),
  date: z.string().nullable(),
});
export type VisitWarning = z.infer<typeof VisitWarningSchema>;

export const VisitAssigneeDtoSchema = z.object({
  userId: Uuid,
  fullName: z.string(),
  isLead: z.boolean(),
});
export type VisitAssigneeDto = z.infer<typeof VisitAssigneeDtoSchema>;

export const VisitDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  projectCode: z.string(),
  projectName: z.string(),
  visitKind: VisitKindEnum,
  status: VisitStatusEnum,
  confirmation: VisitConfirmationEnum,
  origin: VisitOriginEnum,
  generatorKey: z.string().nullable(),
  originalPlannedDate: z.string(),
  plannedDate: z.string(),
  submissionDeadline: z.string().nullable(),
  sprint: z.object({ id: Uuid, number: z.number().int(), name: z.string() }).nullable(),
  assignees: z.array(VisitAssigneeDtoSchema),
  pickedFacilityIds: z.array(Uuid),
  /** The frozen form; null while PROPOSED. */
  formSnapshotId: Uuid.nullable(),
  formHash: z.string().nullable(),
  formAssembledAt: z.string().nullable(),
  facilityCount: z.number().int(),
  recheckCount: z.number().int(),
  rescheduleCount: z.number().int(),
  /** A pending officer proposal (R4b). */
  pendingProposal: z.object({ id: Uuid, toDate: z.string(), comment: z.string(), byName: z.string() }).nullable(),
  checkInAt: z.string().nullable(),
  checkInGeofenceStatus: z.string().nullable(),
  isLate: z.boolean(),
  missedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  publishedAt: z.string().nullable(),
  /** The live (pending or approved) submission, if any (R4c). */
  liveSubmissionId: Uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VisitDto = z.infer<typeof VisitDtoSchema>;

export const ProjectVisitsDtoSchema = z.object({
  visits: z.array(VisitDtoSchema),
  warnings: z.array(VisitWarningSchema),
  /** The tenant's officer move tolerance (working days). */
  toleranceWorkdays: z.number().int(),
});
export type ProjectVisitsDto = z.infer<typeof ProjectVisitsDtoSchema>;

export const VisitPlanPreviewItemSchema = z.object({
  ruleKey: z.string(),
  visitKind: VisitKindEnum,
  date: z.string(),
  /** Already a visit on this project (generator key taken). */
  exists: z.boolean(),
});
export const VisitPlanPreviewDtoSchema = z.object({
  /** Null when the project has no type or the type has no plan. */
  rules: z.array(VisitPlanRuleSchema),
  items: z.array(VisitPlanPreviewItemSchema),
  /** Rules waiting for a later event (completion notice, closing). */
  laterRules: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export type VisitPlanPreviewDto = z.infer<typeof VisitPlanPreviewDtoSchema>;

// ---------------------------------------------------------------------------
// Requests (manager, D-R4.16)
// ---------------------------------------------------------------------------

const Assignees = z
  .array(z.object({ userId: Uuid, isLead: z.boolean().default(false) }))
  .max(10)
  .superRefine((list, ctx) => {
    if (new Set(list.map((a) => a.userId)).size !== list.length) ctx.addIssue({ code: 'custom', message: 'An officer is listed twice' });
    if (list.length > 0 && list.filter((a) => a.isLead).length !== 1) ctx.addIssue({ code: 'custom', message: 'Pick exactly one lead officer' });
  });

export const CreateVisitRequestSchema = z.object({
  visitKind: VisitKindEnum,
  plannedDate: CalendarDate,
  assignees: Assignees.default([]),
  /** AD_HOC: the facilities to check. */
  pickedFacilityIds: z.array(Uuid).max(100).default([]),
  /** Create as PROPOSED (not published) instead of PLANNED. */
  proposed: z.boolean().default(false),
});
export type CreateVisitRequest = z.infer<typeof CreateVisitRequestSchema>;
export type CreateVisitRequestInput = z.input<typeof CreateVisitRequestSchema>;

export const UpdateVisitRequestSchema = z
  .object({
    plannedDate: CalendarDate.optional(),
    assignees: Assignees.optional(),
    pickedFacilityIds: z.array(Uuid).max(100).optional(),
    /** Required when moving a published visit. */
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.plannedDate !== undefined || v.assignees !== undefined || v.pickedFacilityIds !== undefined, { message: 'Nothing to change' });
export type UpdateVisitRequest = z.infer<typeof UpdateVisitRequestSchema>;

export const PublishVisitsRequestSchema = z.object({ visitIds: z.array(Uuid).min(1).max(200) });
export type PublishVisitsRequest = z.infer<typeof PublishVisitsRequestSchema>;

export const CancelVisitRequestSchema = z.object({ reason: Comment });
export type CancelVisitRequest = z.infer<typeof CancelVisitRequestSchema>;

export const GenerateVisitsRequestSchema = z.object({
  /** One rule of the type plan; omitted = every rule whose trigger has happened. */
  ruleKey: z.string().trim().max(32).nullable().default(null),
  /** Officers given to every visit created (optional). */
  assignees: Assignees.default([]),
});
export type GenerateVisitsRequest = z.infer<typeof GenerateVisitsRequestSchema>;
export type GenerateVisitsRequestInput = z.input<typeof GenerateVisitsRequestSchema>;

export const GenerateVisitsResultSchema = z.object({
  created: z.number().int(),
  removed: z.number().int(),
  visits: z.array(VisitDtoSchema),
});
export type GenerateVisitsResult = z.infer<typeof GenerateVisitsResultSchema>;

/** Officers who can carry out visits on a project, and its default officers (setup `visits` step). */
export const VisitOfficersDtoSchema = z.object({
  defaultOfficerIds: z.array(Uuid),
  candidates: z.array(z.object({ userId: Uuid, fullName: z.string(), roleName: z.string(), onProject: z.boolean() })),
});
export type VisitOfficersDto = z.infer<typeof VisitOfficersDtoSchema>;

export const SaveVisitOfficersRequestSchema = z.object({
  /** The first is the lead on generated visits. */
  userIds: z.array(Uuid).max(10),
});
export type SaveVisitOfficersRequest = z.infer<typeof SaveVisitOfficersRequestSchema>;

export const RebuildVisitFormResultSchema = z.object({
  visit: VisitDtoSchema,
  warnings: z.array(VisitFormAssemblyWarningSchema),
  changed: z.boolean(),
});
export type RebuildVisitFormResult = z.infer<typeof RebuildVisitFormResultSchema>;

// ---------------------------------------------------------------------------
// R4b: officer responses and the planner (D-R4.14–D-R4.16)
// ---------------------------------------------------------------------------

export const VisitDateChangeKindEnum = z.enum(['MANAGER_MOVE', 'OFFICER_MOVE', 'OFFICER_PROPOSAL']);
export type VisitDateChangeKind = z.infer<typeof VisitDateChangeKindEnum>;
export const VisitDateChangeStatusEnum = z.enum(['APPLIED', 'PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']);
export type VisitDateChangeStatus = z.infer<typeof VisitDateChangeStatusEnum>;

export const VisitDateChangeDtoSchema = z.object({
  id: Uuid,
  visitId: Uuid,
  kind: VisitDateChangeKindEnum,
  status: VisitDateChangeStatusEnum,
  fromDate: z.string(),
  toDate: z.string(),
  comment: z.string().nullable(),
  byName: z.string(),
  createdAt: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
export type VisitDateChangeDto = z.infer<typeof VisitDateChangeDtoSchema>;

export const VisitResponseActionEnum = z.enum(['CONFIRM', 'MOVE', 'PROPOSE', 'DECLINE']);
export type VisitResponseAction = z.infer<typeof VisitResponseActionEnum>;

export const RespondToVisitRequestSchema = z
  .object({
    /** Client UUID from the phone's outbox; a repeat returns the same result. */
    clientActionId: Uuid,
    action: VisitResponseActionEnum,
    /** MOVE and PROPOSE. */
    date: CalendarDate.nullable().optional(),
    /** Required for MOVE, PROPOSE and DECLINE. */
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === 'MOVE' || v.action === 'PROPOSE') && !v.date) ctx.addIssue({ code: 'custom', message: 'Pick the new date', path: ['date'] });
    if (v.action !== 'CONFIRM' && (v.comment ?? '').length < 3) ctx.addIssue({ code: 'custom', message: 'Say why (at least 3 characters)', path: ['comment'] });
  });
export type RespondToVisitRequest = z.infer<typeof RespondToVisitRequestSchema>;
export type RespondToVisitRequestInput = z.input<typeof RespondToVisitRequestSchema>;

export const DecideVisitProposalRequestSchema = z
  .object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.decision === 'ACCEPT' || (v.note ?? '').length >= 3, { message: 'Say why the date is rejected', path: ['note'] });
export type DecideVisitProposalRequest = z.infer<typeof DecideVisitProposalRequestSchema>;

export const PlannerOfficerSchema = z.object({
  userId: Uuid,
  fullName: z.string(),
  visitCount: z.number().int(),
  /** Applied officer moves and accepted proposals over the visits in range. */
  rescheduleCount: z.number().int(),
});
export const PlannerDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  officers: z.array(PlannerOfficerSchema),
  visits: z.array(VisitDtoSchema),
  warnings: z.array(VisitWarningSchema),
  /** Visits with a pending officer proposal (any date). */
  pendingProposals: z.array(z.object({ visit: VisitDtoSchema, change: VisitDateChangeDtoSchema })),
  /** Declined visits waiting for the manager. */
  declines: z.array(z.object({ visit: VisitDtoSchema, comment: z.string().nullable(), byName: z.string().nullable() })),
});
export type PlannerDto = z.infer<typeof PlannerDtoSchema>;

// ---------------------------------------------------------------------------
// R4c: field API (feed, form, check-in, submission, unscheduled, site log, comments)
// ---------------------------------------------------------------------------

export const VisitOverallFindingEnum = z.enum(['SATISFACTORY', 'MINOR_ISSUES', 'MAJOR_ISSUES']);
export type VisitOverallFinding = z.infer<typeof VisitOverallFindingEnum>;
export const VISIT_OVERALL_FINDING_LABELS: Record<VisitOverallFinding, string> = {
  SATISFACTORY: 'Satisfactory',
  MINOR_ISSUES: 'Minor issues',
  MAJOR_ISSUES: 'Major issues',
};

export const VisitCheckInRequestSchema = z.object({
  clientCheckInId: Uuid,
  /** Device time of the check-in. */
  checkedInAt: z.string().datetime(),
  geotag: SubmissionGeotagInputSchema.nullable().default(null),
});
export type VisitCheckInRequest = z.infer<typeof VisitCheckInRequestSchema>;
export type VisitCheckInRequestInput = z.input<typeof VisitCheckInRequestSchema>;

export const SubmitVisitRequestSchema = z.object({
  clientSubmissionId: Uuid,
  /** The frozen form answered; a different hash than the visit's is 409 FORM_SNAPSHOT_STALE. */
  formSnapshotId: Uuid,
  formHash: z.string().regex(/^[0-9a-f]{64}$/, 'formHash is a SHA-256 hex digest'),
  answers: VisitFormAnswersSchema,
  overallFinding: VisitOverallFindingEnum,
  summaryText: z.string().trim().min(3, 'Write a short summary').max(4000),
  /** Site log entries (photos, voice notes, notes) to attach. */
  siteLogEntryIds: z.array(Uuid).max(100).default([]),
  /** When the phone was offline the whole visit, the check-in rides here. */
  checkIn: VisitCheckInRequestSchema.nullable().default(null),
  submissionGeotag: SubmissionGeotagInputSchema.nullable().default(null),
  /** When the officer tapped submit on the device. */
  confirmedAt: z.string().datetime(),
});
export type SubmitVisitRequest = z.infer<typeof SubmitVisitRequestSchema>;
export type SubmitVisitRequestInput = z.input<typeof SubmitVisitRequestSchema>;

export const VisitSubmissionStatusEnum = z.enum(['PENDING_APPROVAL', 'RETURNED', 'APPROVED']);
export type VisitSubmissionStatus = z.infer<typeof VisitSubmissionStatusEnum>;
export const VISIT_SUBMISSION_STATUS_LABELS: Record<VisitSubmissionStatus, string> = {
  PENDING_APPROVAL: 'Awaiting approval',
  RETURNED: 'Returned',
  APPROVED: 'Accepted',
};

export const SiteLogKindEnum = z.enum(['PHOTO', 'VOICE', 'NOTE']);
export type SiteLogKind = z.infer<typeof SiteLogKindEnum>;

export const SiteLogEntryDtoSchema = z.object({
  id: Uuid,
  clientEntryId: Uuid,
  projectId: Uuid,
  authorUserId: Uuid,
  authorName: z.string(),
  kind: SiteLogKindEnum,
  text: z.string().nullable(),
  capture: CaptureSummarySchema.nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  geofenceStatus: GeofenceStatusEnum.nullable(),
  capturedAt: z.string(),
  attachedSubmissionId: Uuid.nullable(),
  hidden: z.boolean(),
  createdAt: z.string(),
});
export type SiteLogEntryDto = z.infer<typeof SiteLogEntryDtoSchema>;

export const CreateSiteLogEntryRequestSchema = z
  .object({
    clientEntryId: Uuid,
    kind: SiteLogKindEnum,
    /** PHOTO / VOICE: a registered capture of this project, taken by the caller. */
    clientCaptureId: Uuid.nullable().default(null),
    text: z.string().trim().max(4000).nullable().default(null),
    capturedAt: z.string().datetime(),
    /** NOTE: optional device position. */
    geotag: SubmissionGeotagInputSchema.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'NOTE' && !v.clientCaptureId) ctx.addIssue({ code: 'custom', message: 'Attach the photo or voice note', path: ['clientCaptureId'] });
    if (v.kind === 'NOTE' && (v.text ?? '').length < 1) ctx.addIssue({ code: 'custom', message: 'Write the note', path: ['text'] });
  });
export type CreateSiteLogEntryRequest = z.infer<typeof CreateSiteLogEntryRequestSchema>;
export type CreateSiteLogEntryRequestInput = z.input<typeof CreateSiteLogEntryRequestSchema>;

export const VisitAnswerDtoSchema = z.object({
  path: z.string(),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
  comment: z.string().nullable(),
  captures: z.array(CaptureSummarySchema.extend({ unitId: Uuid.nullable() })),
});
export type VisitAnswerDto = z.infer<typeof VisitAnswerDtoSchema>;

export const VisitPhotoGapDtoSchema = z.object({ path: z.string(), unitId: Uuid.nullable(), code: z.string(), clientCaptureId: z.string().optional() });

export const VisitSubmissionDtoSchema = z.object({
  id: Uuid,
  clientSubmissionId: Uuid,
  visitId: Uuid,
  projectId: Uuid,
  revisionNumber: z.number().int(),
  status: VisitSubmissionStatusEnum,
  reporterName: z.string(),
  reporterRoleName: z.string(),
  submittedByUserId: Uuid,
  formSnapshotId: Uuid,
  formHash: z.string(),
  answers: z.array(VisitAnswerDtoSchema),
  overallFinding: VisitOverallFindingEnum,
  summaryText: z.string(),
  submissionGeotag: SubmissionGeotagSchema.nullable(),
  geofenceStatus: GeofenceStatusEnum.nullable(),
  photoGaps: z.array(VisitPhotoGapDtoSchema),
  isLate: z.boolean(),
  confirmedAt: z.string(),
  receivedAt: z.string(),
  approvedAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
  returnedNotes: z.string().nullable(),
  approval: ApprovalProgressDtoSchema.nullable(),
  siteLog: z.array(SiteLogEntryDtoSchema),
  findingIds: z.array(Uuid),
});
export type VisitSubmissionDto = z.infer<typeof VisitSubmissionDtoSchema>;

export const VisitCommentDtoSchema = z.object({
  id: Uuid,
  submissionId: Uuid.nullable(),
  authorName: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type VisitCommentDto = z.infer<typeof VisitCommentDtoSchema>;

export const AddVisitCommentRequestSchema = z.object({ text: z.string().trim().min(1, 'Write the comment').max(2000) });
export type AddVisitCommentRequest = z.infer<typeof AddVisitCommentRequestSchema>;

const MoveWindow = z.object({ from: z.string(), to: z.string() });

export const VisitDetailDtoSchema = z.object({
  visit: VisitDtoSchema,
  dateChanges: z.array(VisitDateChangeDtoSchema),
  submissions: z.array(VisitSubmissionDtoSchema),
  comments: z.array(VisitCommentDtoSchema),
  /** The frozen form (null while PROPOSED). */
  snapshot: VisitFormSnapshotSchema.nullable(),
  /** Dates an officer may move to without asking; null once responses are closed. */
  moveWindow: MoveWindow.nullable(),
});
export type VisitDetailDto = z.infer<typeof VisitDetailDtoSchema>;

export const MyVisitsFeedItemSchema = z.object({ visit: VisitDtoSchema, moveWindow: MoveWindow.nullable() });
export const MyVisitsFeedProjectSchema = z.object({
  projectId: Uuid,
  code: z.string(),
  name: z.string(),
  constructionPhase: z.string(),
  currentSprint: z.object({ number: z.number().int(), name: z.string(), endDate: z.string() }).nullable(),
  openFindings: z.number().int(),
  nextVisitDate: z.string().nullable(),
});
export const MyVisitsFeedDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  toleranceWorkdays: z.number().int(),
  items: z.array(MyVisitsFeedItemSchema),
  projects: z.array(MyVisitsFeedProjectSchema),
});
export type MyVisitsFeedDto = z.infer<typeof MyVisitsFeedDtoSchema>;

export const VisitFormDtoSchema = z.object({
  visitId: Uuid,
  formSnapshotId: Uuid,
  formHash: z.string(),
  snapshot: VisitFormSnapshotSchema,
  geofence: ProjectGeofenceSchema.nullable(),
  geofenceToleranceMeters: z.number().nullable(),
});
export type VisitFormDto = z.infer<typeof VisitFormDtoSchema>;

export const VisitFieldPackDtoSchema = z.object({
  projectId: Uuid,
  /** Everything needed to assemble an Ad hoc form offline (R3 bundle; completed units are R4's). */
  bundle: VisitFormLibraryBundleSchema,
  /** Open findings, as re-check items for the Ad hoc form. */
  rechecks: z.array(RecheckInputSchema),
  geofence: ProjectGeofenceSchema.nullable(),
  generatedAt: z.string(),
});
export type VisitFieldPackDto = z.infer<typeof VisitFieldPackDtoSchema>;

export const CreateUnscheduledVisitRequestSchema = z.object({
  clientVisitId: Uuid,
  visitKind: z.literal('AD_HOC'),
  plannedDate: CalendarDate,
  pickedFacilityIds: z.array(Uuid).min(1, 'Pick at least one facility').max(100),
  /** The component versions the phone assembled from (ids identify versions). */
  components: z.object({
    templateId: Uuid,
    sectionIds: z.array(Uuid).max(40),
    subFormIds: z.array(Uuid).max(100),
  }),
  /** The open findings the phone added as re-checks. */
  recheckIds: z.array(Uuid).max(100).default([]),
  /** SHA-256 of the phone's canonical snapshot; the server re-assembles and compares. */
  formHash: z.string().regex(/^[0-9a-f]{64}$/, 'formHash is a SHA-256 hex digest'),
});
export type CreateUnscheduledVisitRequest = z.infer<typeof CreateUnscheduledVisitRequestSchema>;
export type CreateUnscheduledVisitRequestInput = z.input<typeof CreateUnscheduledVisitRequestSchema>;

// ---------------------------------------------------------------------------
// R4d: review
// ---------------------------------------------------------------------------

export const ReviewVisitSubmissionRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    notes: z.string().trim().max(1500).nullable().optional(),
  })
  .refine((v) => v.decision !== 'RETURN' || (v.notes ?? '').length >= 5, {
    message: 'Say what the officer must change (at least 5 characters)',
    path: ['notes'],
  });
export type ReviewVisitSubmissionRequest = z.infer<typeof ReviewVisitSubmissionRequestSchema>;

/** Raise a finding by hand from an answered question of a visit submission. */
export const RaiseVisitFindingRequestSchema = z.object({
  submissionId: Uuid,
  /** The answer path (s:/f:...). */
  path: z.string().min(3).max(200),
  description: z.string().trim().min(5, 'Describe the finding (at least 5 characters)').max(2000),
  severity: FormFindingSeverityEnum.default('MAJOR'),
  /** Defaults to the project's contractor. */
  projectContractorId: Uuid.nullable().optional(),
});
export type RaiseVisitFindingRequest = z.infer<typeof RaiseVisitFindingRequestSchema>;
export type RaiseVisitFindingRequestInput = z.input<typeof RaiseVisitFindingRequestSchema>;

/** Template data for the contractor findings email (D-R4.29). */
export interface FindingsSummaryEmailData {
  projectCode: string;
  projectName: string;
  visitLabel: string;
  visitDate: string;
  open: Array<{ facility: string | null; unit: string | null; title: string; description: string; severity: string; raisedDate: string; timesRechecked: number }>;
  resolved: Array<{ facility: string | null; unit: string | null; title: string }>;
}

// ---------------------------------------------------------------------------
// R4e: sprint verification (D-R4.31)
// ---------------------------------------------------------------------------

export const SprintVerificationOutcomeEnum = z.enum(['MET', 'PARTLY_MET', 'NOT_MET']);
export type SprintVerificationOutcome = z.infer<typeof SprintVerificationOutcomeEnum>;
export const SPRINT_VERIFICATION_OUTCOME_LABELS: Record<SprintVerificationOutcome, string> = {
  MET: 'Met',
  PARTLY_MET: 'Partly met',
  NOT_MET: 'Not met',
};

export const VerifySprintRequestSchema = z.object({
  outcome: SprintVerificationOutcomeEnum,
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type VerifySprintRequest = z.infer<typeof VerifySprintRequestSchema>;

export const SprintVerificationFacilitySchema = z.object({
  facilityId: Uuid,
  facilityName: z.string(),
  units: z.array(
    z.object({ unitId: Uuid, code: z.string(), label: z.string(), progressPct: z.number().nullable(), progressAsOf: z.string().nullable() })
  ),
  /** The latest accepted visit in the sprint that covered this facility. */
  latestVisit: z
    .object({
      visitId: Uuid,
      visitKind: VisitKindEnum,
      date: z.string(),
      submissionId: Uuid,
      answers: z.array(z.object({ label: z.string(), answer: z.string() })),
    })
    .nullable(),
  openFindings: z.array(z.object({ id: Uuid, title: z.string(), severity: z.string(), raisedDate: z.string() })),
});

export const SprintVerificationViewDtoSchema = z.object({
  sprintId: Uuid,
  number: z.number().int(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  deliverables: z.string(),
  status: z.string(),
  outcome: SprintVerificationOutcomeEnum.nullable(),
  verifiedAt: z.string().nullable(),
  verifiedByName: z.string().nullable(),
  notes: z.string().nullable(),
  firstVerifiedAt: z.string().nullable(),
  /** Verifying before the sprint ends needs a note. */
  endedYet: z.boolean(),
  canVerify: z.boolean(),
  facilities: z.array(SprintVerificationFacilitySchema),
});
export type SprintVerificationViewDto = z.infer<typeof SprintVerificationViewDtoSchema>;
