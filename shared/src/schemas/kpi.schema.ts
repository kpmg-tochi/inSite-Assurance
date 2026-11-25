import { z } from 'zod';
import { ProjectListFiltersSchema } from './deliveryModel.schema';

/**
 * Programme KPIs (Phase 16). The catalogue is code: tenants choose targets and which KPIs to show
 * per project type (`ProjectTypeConfig.kpiTargets`); they never write formulas.
 *
 * Every KPI is a sum of numerators over a sum of denominators across the projects that track it,
 * so a portfolio value is weighted by the underlying counts (or money, for utilisation) rather than
 * an average of project percentages. A project whose inputs are not configured for a KPI does not
 * track it ("not tracked"), which is never shown as 0%.
 */

export const KpiStageEnum = z.enum(['KICKOFF', 'MOBILISATION', 'MONITORING', 'PAYMENTS', 'CLOSURE', 'SCHEDULE']);
export type KpiStage = z.infer<typeof KpiStageEnum>;

export const KPI_STAGE_META: Record<KpiStage, { label: string; order: number }> = {
  KICKOFF: { label: 'Contract kick-off', order: 1 },
  MOBILISATION: { label: 'Mobilisation', order: 2 },
  MONITORING: { label: 'Monitoring and evaluation', order: 3 },
  PAYMENTS: { label: 'Payments', order: 4 },
  CLOSURE: { label: 'Completion and closure', order: 5 },
  SCHEDULE: { label: 'Schedule', order: 6 },
};

export const KpiUnitEnum = z.enum(['PERCENT', 'DAYS']);
export type KpiUnit = z.infer<typeof KpiUnitEnum>;

export const KpiDirectionEnum = z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']);
export type KpiDirection = z.infer<typeof KpiDirectionEnum>;

export const KpiKeyEnum = z.enum([
  'kickoff_agenda_prepared',
  'kickoff_notice_on_time',
  'kickoff_attendance_rate',
  'kickoff_minutes_signed',
  'supervisors_assigned',
  'introduction_letters_on_time',
  'contractors_mobilised_on_time',
  'mobilisation_documents_complete',
  'baseline_uploaded',
  'visits_conducted',
  'reports_on_time',
  'approval_turnaround_days',
  'sprints_verified_on_time',
  'financial_utilisation',
  'verified_on_time',
  'handed_over_on_time',
  'closure_documentation_complete',
  'lessons_documented',
  'audited_post_closure',
  'projects_on_schedule',
]);
export type KpiKey = z.infer<typeof KpiKeyEnum>;

export interface KpiDefinition {
  key: KpiKey;
  label: string;
  stage: KpiStage;
  description: string;
  /** What is counted above the line (shown in the drill-down). */
  numerator: string;
  /** What is counted below the line. */
  denominator: string;
  unit: KpiUnit;
  direction: KpiDirection;
  /**
   * Period-based KPIs count events inside the chosen period (due, held, issued or decided in it).
   * The others show the current value whatever the period.
   */
  periodBased: boolean;
  /** Used when a project type sets no target. null: no target. */
  defaultTarget: number | null;
}

export const KPI_CATALOGUE: KpiDefinition[] = [
  // Kick-off ------------------------------------------------------------------------------------
  {
    key: 'kickoff_agenda_prepared',
    label: 'Kick-off agenda prepared',
    stage: 'KICKOFF',
    description: 'Kick-off meetings in the period that had an agenda document attached.',
    numerator: 'Kick-off meetings with an agenda',
    denominator: 'Kick-off meetings dated in the period (held, or already with an agenda)',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 100,
  },
  {
    key: 'kickoff_notice_on_time',
    label: 'Kick-off notices sent on time',
    stage: 'KICKOFF',
    description: 'Kick-off notices sent at least the notice lead time before the meeting (the kick-off notice milestone met by its due date).',
    numerator: 'Notice milestones done by their due date',
    denominator: 'Notice milestones due in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  {
    key: 'kickoff_attendance_rate',
    label: 'Kick-off attendance',
    stage: 'KICKOFF',
    description: 'Invitees recorded as attending, out of everyone invited, at kick-off meetings held in the period.',
    numerator: 'Invitees who attended',
    denominator: 'Invitees of meetings held in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 80,
  },
  {
    key: 'kickoff_minutes_signed',
    label: 'Kick-off meetings documented and signed',
    stage: 'KICKOFF',
    description: 'Kick-off meetings held in the period whose minutes are filed and signed off (counted from 7 days after the meeting, or earlier once signed).',
    numerator: 'Meetings with signed minutes',
    denominator: 'Meetings held in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  // Mobilisation --------------------------------------------------------------------------------
  {
    key: 'supervisors_assigned',
    label: 'Projects with a supervisor assigned',
    stage: 'MOBILISATION',
    description: "Live projects with at least one assigned user in one of the project type's supervisor roles.",
    numerator: 'Projects with a supervisor',
    denominator: 'Live projects whose type names supervisor roles',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 100,
  },
  {
    key: 'introduction_letters_on_time',
    label: 'Letters of introduction issued on time',
    stage: 'MOBILISATION',
    description: 'Contract milestones that require a letter of introduction, done by their due date.',
    numerator: 'Milestones done by their due date',
    denominator: 'Milestones due in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  {
    key: 'contractors_mobilised_on_time',
    label: 'Contractors mobilised on time',
    stage: 'MOBILISATION',
    description: 'Contractor-on-site milestones done by their due date.',
    numerator: 'Contractors on site by the due date',
    denominator: 'Mobilisation milestones due in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  {
    key: 'mobilisation_documents_complete',
    label: 'Projects with full mobilisation documentation',
    stage: 'MOBILISATION',
    description: 'Projects under construction with every document type the project type requires before mobilisation filed in the register.',
    numerator: 'Projects with every required document',
    denominator: 'Projects under construction whose type requires mobilisation documents',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 100,
  },
  // Monitoring and evaluation -------------------------------------------------------------------
  {
    key: 'baseline_uploaded',
    label: 'Sites with baseline data',
    stage: 'MONITORING',
    description: 'Live projects with an accepted baseline visit.',
    numerator: 'Projects with an accepted baseline',
    denominator: 'Live projects whose visit plan has a baseline visit',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 100,
  },
  {
    key: 'visits_conducted',
    label: 'Visits conducted vs planned',
    stage: 'MONITORING',
    description: 'Planned visits dated in the chosen period that were carried out (on time or late). Unscheduled visits are not counted here.',
    numerator: 'Planned visits submitted',
    denominator: 'Planned visits submitted or missed (cancelled excluded)',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  {
    key: 'reports_on_time',
    label: 'Reports submitted on time',
    stage: 'MONITORING',
    description: 'Visits whose submission deadline fell in the chosen period that were submitted by the deadline (within a week of the visit by default).',
    numerator: 'Submitted by the deadline',
    denominator: 'Visits whose deadline fell in the period and has passed (or that were submitted)',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 85,
  },
  {
    key: 'approval_turnaround_days',
    label: 'Average approval turnaround',
    stage: 'MONITORING',
    description: 'Days from submission to final approval, for visits approved in the period on projects that require report approval.',
    numerator: 'Total days to approval',
    denominator: 'Items approved in the period',
    unit: 'DAYS',
    direction: 'LOWER_IS_BETTER',
    periodBased: true,
    defaultTarget: 5,
  },
  {
    key: 'sprints_verified_on_time',
    label: 'Sprints verified on time',
    stage: 'MONITORING',
    description: 'Sprints whose verification was due in the chosen period (end date plus the verification period) that were verified by then.',
    numerator: 'Verified by the due date',
    denominator: 'Sprints whose verification fell due in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  // Payments ------------------------------------------------------------------------------------
  {
    key: 'financial_utilisation',
    label: 'Financial utilisation',
    stage: 'PAYMENTS',
    description: 'Amount paid to date (net, from the payment record) out of the project budget (weighted by budget across projects).',
    numerator: 'Paid to date (NGN)',
    denominator: 'Budget (NGN)',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: null,
  },
  // Completion and closure ----------------------------------------------------------------------
  {
    key: 'verified_on_time',
    label: 'Verified on time and to specification',
    stage: 'CLOSURE',
    description:
      'Certificates of Completion issued in the period with a completion date on or before the planned end, and no major issues in the final evaluation.',
    numerator: 'On time and without major issues',
    denominator: 'Certificates issued in the period (projects with a planned end date)',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 80,
  },
  {
    key: 'handed_over_on_time',
    label: 'Handed over on time after the CoC',
    stage: 'CLOSURE',
    description: 'Handover milestones (due a set number of days after the Certificate of Completion) done by their due date.',
    numerator: 'Handovers accepted by the due date',
    denominator: 'Handover milestones due in the period',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: true,
    defaultTarget: 90,
  },
  {
    key: 'closure_documentation_complete',
    label: 'Projects with full closure documentation',
    stage: 'CLOSURE',
    description: 'Projects past handover with a document filed for every document item of their closure checklists.',
    numerator: 'Projects with every closure document',
    denominator: 'Projects in their liability period or closed, whose checklists list documents',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 100,
  },
  {
    key: 'lessons_documented',
    label: 'Lessons learned documented',
    stage: 'CLOSURE',
    description: 'Closed projects whose closeout report is filed: the closeout report carries the lessons learned (R7, owner decision 2026-11-25).',
    numerator: 'Closed projects with a closeout report filed',
    denominator: 'Closed projects',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 100,
  },
  {
    key: 'audited_post_closure',
    label: 'Projects audited after closure',
    stage: 'CLOSURE',
    description: 'Closed projects whose audit sign-off checklist item is signed off.',
    numerator: 'Closed projects signed off',
    denominator: 'Closed projects whose checklists include an audit sign-off',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 100,
  },
  // Schedule ------------------------------------------------------------------------------------
  {
    key: 'projects_on_schedule',
    label: 'Projects on schedule',
    stage: 'SCHEDULE',
    description: 'Projects under construction whose schedule badge is on track, ahead or complete (the rest are behind).',
    numerator: 'On track, ahead or complete',
    denominator: 'Projects under construction with a schedule badge',
    unit: 'PERCENT',
    direction: 'HIGHER_IS_BETTER',
    periodBased: false,
    defaultTarget: 80,
  },
];

export const KPI_BY_KEY: Record<KpiKey, KpiDefinition> = Object.fromEntries(KPI_CATALOGUE.map((k) => [k.key, k])) as Record<
  KpiKey,
  KpiDefinition
>;

// ---------------------------------------------------------------------------
// Targets on a project type
// ---------------------------------------------------------------------------

export const KpiTargetSettingSchema = z.object({
  /** null: no target (the KPI is shown without a status colour). */
  target: z.number().min(0).max(100_000).nullable().default(null),
  shown: z.boolean().default(true),
});
export type KpiTargetSetting = z.infer<typeof KpiTargetSettingSchema>;

/**
 * `ProjectTypeConfig.kpiTargets`: one entry per KPI key; a KPI without an entry uses the catalogue
 * default target and is shown. Keys are free strings so a type saved before a KPI is renamed still
 * parses; unknown keys are ignored.
 */
export const ProjectTypeKpiTargetsSchema = z.record(z.string().max(64), KpiTargetSettingSchema);
export type ProjectTypeKpiTargets = z.infer<typeof ProjectTypeKpiTargetsSchema>;

/** The target and visibility of every catalogue KPI for a type's settings (null = no type). */
export function resolveKpiTargets(targets: ProjectTypeKpiTargets | null | undefined): Record<KpiKey, { target: number | null; shown: boolean }> {
  const out = {} as Record<KpiKey, { target: number | null; shown: boolean }>;
  for (const def of KPI_CATALOGUE) {
    const setting = targets?.[def.key];
    out[def.key] = setting ? { target: setting.target, shown: setting.shown } : { target: def.defaultTarget, shown: true };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Values and status
// ---------------------------------------------------------------------------

/**
 * MET: meets the target. NEAR: within 10% of it. MISSED: further away. NO_TARGET: tracked, no
 * target. NO_DATA: tracked, but nothing fell in the period. NOT_TRACKED: no project tracks it.
 */
export const KpiStatusEnum = z.enum(['MET', 'NEAR', 'MISSED', 'NO_TARGET', 'NO_DATA', 'NOT_TRACKED']);
export type KpiStatus = z.infer<typeof KpiStatusEnum>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The value of a KPI from its sums; null when the denominator is 0. */
export function kpiValue(def: Pick<KpiDefinition, 'unit'>, numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return def.unit === 'PERCENT' ? round1((numerator / denominator) * 100) : round1(numerator / denominator);
}

export function kpiStatus(
  def: Pick<KpiDefinition, 'direction'>,
  tracked: boolean,
  value: number | null,
  target: number | null
): KpiStatus {
  if (!tracked) return 'NOT_TRACKED';
  if (value === null) return 'NO_DATA';
  if (target === null) return 'NO_TARGET';
  if (def.direction === 'HIGHER_IS_BETTER') {
    if (value >= target) return 'MET';
    return value >= target * 0.9 ? 'NEAR' : 'MISSED';
  }
  if (value <= target) return 'MET';
  return value <= target * 1.1 || value - target <= 1 ? 'NEAR' : 'MISSED';
}

export function formatKpiValue(def: Pick<KpiDefinition, 'unit'>, value: number | null): string {
  if (value === null) return '–';
  return def.unit === 'PERCENT' ? `${value}%` : `${value} day${value === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Requests and DTOs
// ---------------------------------------------------------------------------

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const KpiQuerySchema = ProjectListFiltersSchema.extend({
  /** First day of the period (default: the first of the current month). */
  from: IsoDate.optional(),
  /** Last day of the period, inclusive (default: today). */
  to: IsoDate.optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The period must start before it ends', path: ['to'] });
export type KpiQuery = z.infer<typeof KpiQuerySchema>;

export const KpiPeriodSchema = z.object({ from: IsoDate, to: IsoDate });
export type KpiPeriod = z.infer<typeof KpiPeriodSchema>;

/** One KPI's figures over a set of projects (or one project). */
export const KpiValueDtoSchema = z.object({
  key: KpiKeyEnum,
  status: KpiStatusEnum,
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  target: z.number().nullable(),
  /** The contributing projects' types set different targets (no single target applies). */
  targetVaries: z.boolean(),
  /** Projects that track the KPI. */
  trackedProjectCount: z.number().int(),
});
export type KpiValueDto = z.infer<typeof KpiValueDtoSchema>;

export const KpiTrendPointSchema = z.object({ periodStart: IsoDate, value: z.number().nullable() });
export type KpiTrendPoint = z.infer<typeof KpiTrendPointSchema>;

export const KpiTypeBreakdownSchema = z.object({
  projectTypeId: z.string().uuid().nullable(),
  projectTypeName: z.string(),
  status: KpiStatusEnum,
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  target: z.number().nullable(),
  trackedProjectCount: z.number().int(),
});
export type KpiTypeBreakdown = z.infer<typeof KpiTypeBreakdownSchema>;

export const KpiDashboardKpiSchema = KpiValueDtoSchema.extend({
  /** Monthly values from the daily snapshots, oldest first (up to six months). */
  trend: z.array(KpiTrendPointSchema),
  byProjectType: z.array(KpiTypeBreakdownSchema),
});
export type KpiDashboardKpi = z.infer<typeof KpiDashboardKpiSchema>;

/** One project's figures, for the drill-down and the CSV export. */
export const KpiProjectCellSchema = z.object({
  status: KpiStatusEnum,
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  target: z.number().nullable(),
});
export type KpiProjectCell = z.infer<typeof KpiProjectCellSchema>;

export const KpiProjectRowSchema = z.object({
  projectId: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  status: z.string(),
  constructionPhase: z.string(),
  projectTypeId: z.string().uuid().nullable(),
  projectTypeName: z.string().nullable(),
  regionName: z.string().nullable(),
  owningOrganizationId: z.string().uuid().nullable(),
  owningOrganizationName: z.string().nullable(),
  /** Only KPIs the project tracks (and its type shows). */
  values: z.record(z.string(), KpiProjectCellSchema),
});
export type KpiProjectRow = z.infer<typeof KpiProjectRowSchema>;

export const KpiDashboardDtoSchema = z.object({
  period: KpiPeriodSchema,
  /** The tenant time zone the period's days are read in. */
  timeZone: z.string(),
  generatedAt: z.string(),
  projectCount: z.number().int(),
  /** Catalogue order; KPIs hidden on every contributing project type are left out. */
  kpis: z.array(KpiDashboardKpiSchema),
  projects: z.array(KpiProjectRowSchema),
});
export type KpiDashboardDto = z.infer<typeof KpiDashboardDtoSchema>;

export const ProjectKpisDtoSchema = z.object({
  projectId: z.string().uuid(),
  period: KpiPeriodSchema,
  /** The tenant time zone the period's days are read in. */
  timeZone: z.string(),
  generatedAt: z.string(),
  /** KPIs the project's type shows, tracked or not. */
  kpis: z.array(KpiValueDtoSchema),
});
export type ProjectKpisDto = z.infer<typeof ProjectKpisDtoSchema>;

/** Default period: the first of the month of `today` (the tenant's calendar date) to `today`. */
export function defaultKpiPeriod(today: string): KpiPeriod {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
