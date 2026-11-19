import { z } from 'zod';
import { CALENDAR_DATE_REGEX } from '../utils/time';

/**
 * Phase 9: schedule baseline, variance and "Catch Project Up" revisions.
 * Dates are calendar dates (YYYY-MM-DD) in the project's time zone. Variance is in working days of
 * the project's work-week; positive = ahead, negative = behind.
 */

const CalendarDate = z.string().regex(CALENDAR_DATE_REGEX, 'Use YYYY-MM-DD');

export const ScheduleStatusEnum = z.enum(['NOT_STARTED', 'ON_TRACK', 'AHEAD', 'BEHIND', 'COMPLETE', 'UNSCHEDULED']);
export type ScheduleStatusValue = z.infer<typeof ScheduleStatusEnum>;

export const SCHEDULE_STATUS_META: Record<ScheduleStatusValue, { label: string; tone: 'positive' | 'neutral' | 'warning' | 'critical' | 'muted' }> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  ON_TRACK: { label: 'On schedule', tone: 'positive' },
  AHEAD: { label: 'Ahead', tone: 'positive' },
  BEHIND: { label: 'Behind', tone: 'critical' },
  COMPLETE: { label: 'Complete', tone: 'positive' },
  UNSCHEDULED: { label: 'No schedule', tone: 'muted' },
};

export const ScheduleRevisionStatusEnum = z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'WITHDRAWN']);
export type ScheduleRevisionStatus = z.infer<typeof ScheduleRevisionStatusEnum>;

/** The variance badge shown on the directory, dashboard and executive matrix. */
export const ScheduleVarianceBadgeSchema = z.object({
  status: ScheduleStatusEnum,
  /** Rounded to the nearest half week, in working days; null when unscheduled. */
  varianceWorkdays: z.number().nullable(),
  /** e.g. "On schedule", "4 weeks behind". */
  label: z.string(),
  computedAt: z.string().nullable(),
});
export type ScheduleVarianceBadge = z.infer<typeof ScheduleVarianceBadgeSchema>;

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export const ScheduleDependencyInputSchema = z.object({
  predecessorBoqItemId: z.string().uuid(),
  successorBoqItemId: z.string().uuid(),
  lagWorkdays: z.number().int().min(0).max(365).default(0),
});
export type ScheduleDependencyInput = z.infer<typeof ScheduleDependencyInputSchema>;

/**
 * PUT /projects/:projectId/schedule/baseline. Replaces the project dates, the dates of the listed
 * items and the whole dependency list. Items not listed keep their dates.
 * On a live project with a baseline, existing dates can only move through a revision; this
 * endpoint then only dates items that have none yet and edits dependencies.
 */
export const SaveScheduleBaselineRequestSchema = z.object({
  plannedStartDate: CalendarDate,
  plannedEndDate: CalendarDate,
  items: z
    .array(
      z.object({
        boqItemId: z.string().uuid(),
        plannedStartDate: CalendarDate.nullable(),
        plannedEndDate: CalendarDate.nullable(),
      })
    )
    .max(5000),
  dependencies: z.array(ScheduleDependencyInputSchema).max(10000),
});
export type SaveScheduleBaselineRequest = z.infer<typeof SaveScheduleBaselineRequestSchema>;

/** POST /projects/:projectId/schedule/propose-dates: a suggestion only, nothing is saved. */
export const ProposeScheduleDatesRequestSchema = z.object({
  plannedStartDate: CalendarDate,
  plannedEndDate: CalendarDate,
  /** Limit the suggestion to these items (default: every item). */
  boqItemIds: z.array(z.string().uuid()).optional(),
});
export type ProposeScheduleDatesRequest = z.infer<typeof ProposeScheduleDatesRequestSchema>;

export const ProposedScheduleDatesDtoSchema = z.object({
  items: z.array(z.object({ boqItemId: z.string().uuid(), plannedStartDate: z.string(), plannedEndDate: z.string() })),
});
export type ProposedScheduleDatesDto = z.infer<typeof ProposedScheduleDatesDtoSchema>;

// ---------------------------------------------------------------------------
// Schedule view
// ---------------------------------------------------------------------------

export const ScheduleItemDtoSchema = z.object({
  id: z.string().uuid(),
  wbsCode: z.string(),
  section: z.string(),
  description: z.string(),
  budgetedCostNgn: z.number(),
  isHoldPoint: z.boolean(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  originalPlannedStartDate: z.string().nullable(),
  originalPlannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualCompletionDate: z.string().nullable(),
  durationWorkdays: z.number().int(),
  /** Certified by valuation (Phase 3); drives the variance. */
  certifiedProgressPct: z.number(),
  /** From approved or confirmed field reports (not yet certified). */
  reportedProgressPct: z.number(),
  /** Percent planned by the end of yesterday. */
  expectedPct: z.number(),
  status: ScheduleStatusEnum,
  varianceWorkdays: z.number().nullable(),
  varianceLabel: z.string(),
  reportedStatus: ScheduleStatusEnum,
  reportedVarianceWorkdays: z.number().nullable(),
  reportedVarianceLabel: z.string(),
  predecessorIds: z.array(z.string().uuid()),
});
export type ScheduleItemDto = z.infer<typeof ScheduleItemDtoSchema>;

export const ScheduleDependencyDtoSchema = z.object({
  id: z.string().uuid(),
  predecessorBoqItemId: z.string().uuid(),
  successorBoqItemId: z.string().uuid(),
  lagWorkdays: z.number().int(),
});
export type ScheduleDependencyDto = z.infer<typeof ScheduleDependencyDtoSchema>;

export const ScheduleAdjustmentDtoSchema = z.object({
  boqItemId: z.string().uuid(),
  wbsCode: z.string().optional(),
  description: z.string().optional(),
  previousStartDate: z.string(),
  previousEndDate: z.string(),
  newStartDate: z.string(),
  newEndDate: z.string(),
  shiftWorkdays: z.number().int(),
  cause: z.enum(['REQUESTED', 'DEPENDENCY']),
});
export type ScheduleAdjustmentDto = z.infer<typeof ScheduleAdjustmentDtoSchema>;

export const ScheduleChangeInputSchema = z
  .object({
    boqItemId: z.string().uuid(),
    newStartDate: CalendarDate.nullable().optional(),
    shiftWorkdays: z.number().int().min(-260).max(520).nullable().optional(),
  })
  .refine((c) => Boolean(c.newStartDate) !== (c.shiftWorkdays !== null && c.shiftWorkdays !== undefined), {
    message: 'Give either a new start date or a shift in working days',
    path: ['newStartDate'],
  });
export type ScheduleChangeInput = z.infer<typeof ScheduleChangeInputSchema>;

const ChangesList = z
  .array(ScheduleChangeInputSchema)
  .min(1, 'Choose at least one delayed item')
  .max(500)
  .refine((list) => new Set(list.map((c) => c.boqItemId)).size === list.length, 'Each item can be changed once');

/** POST /projects/:projectId/schedule/revisions/preview: nothing is saved. */
export const PreviewScheduleRevisionRequestSchema = z.object({
  changes: ChangesList,
  reason: z.string().trim().max(2000).optional(),
});
export type PreviewScheduleRevisionRequest = z.infer<typeof PreviewScheduleRevisionRequestSchema>;

/** POST /projects/:projectId/schedule/revisions */
export const CreateScheduleRevisionRequestSchema = z.object({
  changes: ChangesList,
  reason: z.string().trim().min(10, 'Explain the delay in at least 10 characters').max(2000),
});
export type CreateScheduleRevisionRequest = z.infer<typeof CreateScheduleRevisionRequestSchema>;

export const DecideScheduleRevisionRequestSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type DecideScheduleRevisionRequest = z.infer<typeof DecideScheduleRevisionRequestSchema>;

export const ScheduleRevisionPreviewDtoSchema = z.object({
  adjustments: z.array(ScheduleAdjustmentDtoSchema),
  previousProjectedEndDate: z.string().nullable(),
  newProjectedEndDate: z.string().nullable(),
  /** Working days the projected end moves (positive = later). */
  endShiftWorkdays: z.number().int(),
  /** Sum of every moved item's shift. */
  totalShiftedWorkdays: z.number().int(),
  /** Moving the end date needs a second person's approval; otherwise it applies at once. */
  requiresApproval: z.boolean(),
});
export type ScheduleRevisionPreviewDto = z.infer<typeof ScheduleRevisionPreviewDtoSchema>;

export const ScheduleRevisionDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionNumber: z.number().int(),
  status: ScheduleRevisionStatusEnum,
  reason: z.string(),
  initiatedByUserId: z.string().uuid(),
  initiatedByName: z.string(),
  /** Who approved or rejected it (null while pending, and for revisions applied without approval). */
  decidedByUserId: z.string().uuid().nullable(),
  decidedByName: z.string().nullable(),
  decisionNotes: z.string().nullable(),
  previousProjectedEndDate: z.string().nullable(),
  newProjectedEndDate: z.string().nullable(),
  totalShiftedWorkdays: z.number().int(),
  changes: z.array(z.object({ boqItemId: z.string(), newStartDate: z.string().nullable().optional(), shiftWorkdays: z.number().nullable().optional() })),
  adjustments: z.array(ScheduleAdjustmentDtoSchema),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  /** For the caller: may approve or reject this revision now. */
  canDecide: z.boolean(),
  /** For the caller: proposed it and it is still pending, so may withdraw it. */
  canWithdraw: z.boolean(),
});
export type ScheduleRevisionDto = z.infer<typeof ScheduleRevisionDtoSchema>;

export const ProjectScheduleSummarySchema = z.object({
  hasBaseline: z.boolean(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  originalPlannedEndDate: z.string().nullable(),
  /** End of the current plan (after approved revisions). */
  currentProjectedEndDate: z.string().nullable(),
  /** Remaining work at planned rates from today (certified progress). */
  forecastEndDate: z.string().nullable(),
  forecastSlipWorkdays: z.number().nullable(),
  actualStartDate: z.string().nullable(),
  certifiedProgressPct: z.number(),
  reportedProgressPct: z.number(),
  status: ScheduleStatusEnum,
  varianceWorkdays: z.number().nullable(),
  varianceLabel: z.string(),
  reportedStatus: ScheduleStatusEnum,
  reportedVarianceWorkdays: z.number().nullable(),
  reportedVarianceLabel: z.string(),
  scheduledItemCount: z.number().int(),
  unscheduledItemCount: z.number().int(),
});
export type ProjectScheduleSummary = z.infer<typeof ProjectScheduleSummarySchema>;

export const ProjectScheduleDtoSchema = z.object({
  projectId: z.string().uuid(),
  projectStatus: z.string(),
  today: z.string(),
  timezone: z.string(),
  workWeekDays: z.array(z.number().int()),
  summary: ProjectScheduleSummarySchema,
  items: z.array(ScheduleItemDtoSchema),
  dependencies: z.array(ScheduleDependencyDtoSchema),
  pendingRevision: ScheduleRevisionDtoSchema.nullable(),
  /** On a live project with a baseline, dated items only move through a revision. */
  baselineLocked: z.boolean(),
});
export type ProjectScheduleDto = z.infer<typeof ProjectScheduleDtoSchema>;
