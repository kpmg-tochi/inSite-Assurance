import { z } from 'zod';
import { SprintStatusEnum } from './scope.schema';
import { VisitConfirmationEnum, VisitStatusEnum } from './visit.schema';
import { VisitKindEnum } from './form.schema';
import { ProjectAlertKeyEnum } from './projectAlert.schema';

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
  /** UBEC IRL: active early-warning alerts (PROJECT_ALERT_KEYS order; spend only for payment viewers). */
  activeAlerts: z.array(ProjectAlertKeyEnum),
  /** When each active alert was raised (ISO time). */
  alertRaisedAt: z.record(ProjectAlertKeyEnum, z.string()),
});
export type ProjectOverviewDto = z.infer<typeof ProjectOverviewDtoSchema>;

/**
 * Design round 2026-11-26: the Overview dashboard's charts, `GET /projects/:id/overview/charts`.
 * One request, computed on the server. A section the caller may not see is null (never zero); a
 * section with nothing to show yet is an empty list. Months are calendar months in the project zone.
 */

/** One month of the progress curve. Percentages 0–100, rounded to one decimal. */
export const OverviewProgressPointSchema = z.object({
  /** YYYY-MM */
  month: z.string(),
  /** The point's date: the month's last day, or today for the current month (YYYY-MM-DD). */
  date: z.string(),
  /** Budget-weighted planned % complete from the lines' planned windows (linear); null when no line has one. */
  plannedPct: z.number().nullable(),
  /** % complete at that date from accepted monitoring reports; null after today. */
  actualPct: z.number().nullable(),
  /** Cumulative gross paid (interim + final, not voided) over the contract sum (else budget); null after today or without payments permission. */
  paidPct: z.number().nullable(),
});
export type OverviewProgressPoint = z.infer<typeof OverviewProgressPointSchema>;

export const OverviewProgressCurveSchema = z.object({
  points: z.array(OverviewProgressPointSchema),
  /** What paidPct is measured against; null when paidPct is not shown. */
  paidBasis: z.enum(['CONTRACT_SUM', 'BUDGET']).nullable(),
  /** The project's current % complete (the curve's last actual point equals it). */
  currentPct: z.number(),
  /** Planned % complete today; null when no line has a planned window. */
  plannedTodayPct: z.number().nullable(),
});
export type OverviewProgressCurve = z.infer<typeof OverviewProgressCurveSchema>;

export const OverviewUnitProgressSchema = z.object({
  unitId: z.string().uuid(),
  /** Workbook "Unit ID". */
  unitCode: z.string(),
  facilityName: z.string(),
  siteNumber: z.number().int().nullable(),
  siteName: z.string().nullable(),
  progressPct: z.number(),
  /** Expected % today from the unit's lines' planned windows; null without windows. */
  plannedPct: z.number().nullable(),
  /** The unit's end work phase has ended and a line is below 100% (the R2 behind rule). */
  behind: z.boolean(),
  amountNgn: z.number(),
});
export type OverviewUnitProgress = z.infer<typeof OverviewUnitProgressSchema>;

export const OverviewWorkPhaseSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  name: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  status: SprintStatusEnum,
  verificationOutcome: z.enum(['MET', 'PARTLY_MET', 'NOT_MET']).nullable(),
  unitCount: z.number().int(),
});
export type OverviewWorkPhase = z.infer<typeof OverviewWorkPhaseSchema>;

/** Monitoring visits by planned month: six months back, the current month and two ahead. */
export const OverviewVisitMonthSchema = z.object({
  month: z.string(),
  /** Report accepted (APPROVED). */
  accepted: z.number().int(),
  /** SUBMITTED (awaiting review). */
  awaitingReview: z.number().int(),
  returned: z.number().int(),
  missed: z.number().int(),
  /** PROPOSED, PLANNED or IN_PROGRESS. */
  upcoming: z.number().int(),
});
export type OverviewVisitMonth = z.infer<typeof OverviewVisitMonthSchema>;

export const OverviewFindingSeverityRowSchema = z.object({
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  open: z.number().int(),
  /** Open longer than the type's escalation days (`monitoring.findingEscalationDays`). */
  openOverdue: z.number().int(),
  resolved: z.number().int(),
  dismissed: z.number().int(),
});
export type OverviewFindingSeverityRow = z.infer<typeof OverviewFindingSeverityRowSchema>;

export const OverviewMoneySchema = z.object({
  budgetNgn: z.number(),
  contractSumNgn: z.number().nullable(),
  /** Interim + final, gross (before retention), not voided. */
  paidGrossNgn: z.number(),
  /** Net paid to date (Project.disbursedToDateNgn). */
  paidNetNgn: z.number(),
  retentionHeldNgn: z.number(),
  retentionReleasedNgn: z.number(),
  /** Contract sum (else budget) minus gross paid, never below 0. */
  remainingNgn: z.number(),
  /** Gross paid per quarter (YYYY-Qn), oldest first, from the first payment to today. */
  byQuarter: z.array(z.object({ quarter: z.string(), paidGrossNgn: z.number() })),
});
export type OverviewMoney = z.infer<typeof OverviewMoneySchema>;

export const ProjectOverviewChartsDtoSchema = z.object({
  projectId: z.string().uuid(),
  today: z.string(),
  /** null without `scope:view`. */
  progressCurve: OverviewProgressCurveSchema.nullable(),
  /** null without `scope:view`; [] when the project has no units. */
  units: z.array(OverviewUnitProgressSchema).nullable(),
  /** null without `scope:view`; [] without work phases. */
  workPhases: z.array(OverviewWorkPhaseSchema).nullable(),
  /** null without `visits:view`. Always 9 months. */
  visitsByMonth: z.array(OverviewVisitMonthSchema).nullable(),
  /** null without `visits:view` or `findings:manage`. Always the three severities. */
  findingsBySeverity: z.array(OverviewFindingSeverityRowSchema).nullable(),
  /** null without `payments:view` or `payments:record`. */
  money: OverviewMoneySchema.nullable(),
});
export type ProjectOverviewChartsDto = z.infer<typeof ProjectOverviewChartsDtoSchema>;
