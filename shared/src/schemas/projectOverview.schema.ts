import { z } from 'zod';
import { SprintStatusEnum } from './scope.schema';
import { VisitConfirmationEnum, VisitStatusEnum } from './visit.schema';
import { VisitKindEnum } from './form.schema';

/**
 * Redesign R6c: project stage and the Overview DTO (D-R6.18). The stage is also carried by the
 * project directory / portfolio rows (D-R6.22) and the mobile baseline pack (R5, D-R5.3).
 */
export const ProjectStageKeyEnum = z.enum(['KICKOFF', 'MOBILISATION', 'CONSTRUCTION', 'COMPLETION', 'CLOSURE']);
export type ProjectStageKey = z.infer<typeof ProjectStageKeyEnum>;

export const ProjectStageStateEnum = z.enum(['DONE', 'CURRENT', 'UPCOMING', 'NOT_TRACKED']);
export type ProjectStageState = z.infer<typeof ProjectStageStateEnum>;

export const ProjectStageEntrySchema = z.object({
  key: ProjectStageKeyEnum,
  label: z.string(),
  state: ProjectStageStateEnum,
  /** ISO timestamp the stage was entered, null when not recorded or not reached. */
  enteredAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type ProjectStageEntry = z.infer<typeof ProjectStageEntrySchema>;

export const ProjectStageSchema = z.object({
  current: ProjectStageKeyEnum,
  currentLabel: z.string(),
  /** Closure only: "Defects liability period", "Closed" or "Archived". */
  subLabel: z.string().nullable(),
  stages: z.array(ProjectStageEntrySchema),
  flags: z.object({ contractTerminated: z.boolean(), archived: z.boolean() }),
});
export type ProjectStage = z.infer<typeof ProjectStageSchema>;

/** Light form for list rows and chips. */
export const ProjectStageSummarySchema = ProjectStageSchema.pick({ current: true, currentLabel: true, subLabel: true }).extend({
  contractTerminated: z.boolean(),
});
export type ProjectStageSummary = z.infer<typeof ProjectStageSummarySchema>;

export const OverviewSprintSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  name: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  /** First line of the deliverables, null when none. */
  deliverables: z.string().nullable(),
  status: SprintStatusEnum,
  verificationOutcome: z.enum(['MET', 'PARTLY_MET', 'NOT_MET']).nullable(),
  totalSprints: z.number().int(),
  activeUnitCount: z.number().int(),
  /** ACTIVE: today falls in it; NEXT: none active, the next upcoming; LAST: all ended. */
  relation: z.enum(['ACTIVE', 'NEXT', 'LAST']),
});
export type OverviewSprint = z.infer<typeof OverviewSprintSchema>;

export const OverviewNextVisitSchema = z.object({
  id: z.string().uuid(),
  visitKind: VisitKindEnum,
  plannedDate: z.string(),
  status: VisitStatusEnum,
  confirmation: VisitConfirmationEnum,
  officerNames: z.array(z.string()),
});
export type OverviewNextVisit = z.infer<typeof OverviewNextVisitSchema>;

export const OverviewDeadlineSchema = z.object({
  kind: z.enum(['MILESTONE', 'VISIT_SUBMISSION']),
  label: z.string(),
  dueDate: z.string(),
  overdue: z.boolean(),
  milestoneId: z.string().uuid().nullable(),
  visitId: z.string().uuid().nullable(),
});
export type OverviewDeadline = z.infer<typeof OverviewDeadlineSchema>;

/** Sections the caller may not see are null, never zero. */
export const ProjectOverviewDtoSchema = z.object({
  projectId: z.string().uuid(),
  /** YYYY-MM-DD in the project zone. */
  today: z.string(),
  stage: ProjectStageSchema,
  currentSprint: OverviewSprintSchema.nullable(),
  /** false when the project has no sprints; null when the caller lacks `scope:view`. */
  hasSprints: z.boolean().nullable(),
  nextVisit: OverviewNextVisitSchema.nullable(),
  nextDeadline: OverviewDeadlineSchema.nullable(),
  overdueMilestoneCount: z.number().int().nullable(),
  openDefectCount: z.number().int().nullable(),
  openFindingCount: z.number().int().nullable(),
});
export type ProjectOverviewDto = z.infer<typeof ProjectOverviewDtoSchema>;
